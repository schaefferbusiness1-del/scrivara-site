'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf('/* =============================================================================\n * __mlsEz3Flow');
const end = source.indexOf('/* =============================================================================\n * __mlsGuidedTour', start);
assert(start >= 0 && end > start, 'easy visit flow module boundary was not found');
const flow = source.slice(start, end);

/* fl-1.6.0: the flow module keeps ONE canonical lane and the ACTIVE engine's
   render owner (v3.7.1 setWrapHtml) preserves that exact node synchronously
   through every #ez3Wrap innerHTML rewrite. The old false-confidence version
   of this test only exercised the flow reconciler; the engine-rewrite path is
   now covered by easy-lane-engine-rewrite-runtime.test.js. */
assert(flow.includes("var VERSION = 'fl-1.6.1'"), 'persistent transcript lifecycle release is not installed');
assert(!flow.includes('function nativeDoctorScreen()'), 'transient native-doctor state still owns transcript mounting');
assert(!/nativeDoctor[\s\S]{0,180}\.ez3fl-record[\s\S]{0,80}remove\(/.test(flow), 'native doctor reconciliation can still remove the transcript lane');
assert(flow.includes("var mountedLanes = body.querySelectorAll('.ez3fl-record')"), 'easy flow does not reconcile one persistent transcript lane');
assert(flow.includes('_primaryLane && _primaryLane.isConnected && body.contains(_primaryLane)'), 'easy flow does not prefer the tracked primary lane when still mounted');
assert(flow.includes('if (mountedLanes[laneIndex] !== mountedLane) mountedLanes[laneIndex].remove()'), 'easy flow does not remove only accidental duplicate lanes');
assert(flow.includes('syncTopLane(mountedLane)'), 'existing transcript lane is not synchronized in place');
assert(flow.includes("var kill = staff ? '.ez3fl-staffLink,.ez3fl-record' : '.ez3fl-back,.ez3fl-staffbadge'"), 'transcript lane cleanup is not limited to an actual staff-screen transition');

/* the lane must keep its historical visual position: inside #ez3Wrap before
   the screen's first action row, NOT hoisted above the day/patient controls */
assert(flow.includes('wrap.insertBefore(rec, row2)'), 'the lane is no longer created at its in-wrap position before .ez3-row2');
assert(!flow.includes('ez3flStableHost'), 'the abandoned stable-host reparent (which reordered the workflow) resurfaced');

/* the easy Dictate chip binds the real direct API and keeps the dock fallback */
assert(flow.includes('dictate.toggleFor(top)'), 'the easy Dictate chip does not use the direct dictation API');
assert(flow.includes("clickTopVoiceControl('mlsDaDock', 'Dictate')"), 'the legacy dictation dock fallback was removed');

/* pause is non-destructive: never through the legacy captureBtn stop path */
assert(flow.includes("setLaneText(rbLabel, live ? '\\u23F8 Pause recording'"), 'the live recording button does not read Pause recording');
assert(flow.includes('segStop.stopSegment()'), 'pausing does not close the armed segment');
assert(!/else \{\s*try \{ cb\.click\(\); finishTopSegmentAfterStop\(\); \}/.test(flow), 'pausing still routes through the legacy stop-visit click path first');

console.log('PASS easy transcript continuity: one lane persists at its in-wrap position and is removed only for staff mode');
