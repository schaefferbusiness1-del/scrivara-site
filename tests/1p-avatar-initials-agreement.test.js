'use strict';

/*
 * FOUR INITIALS GENERATORS, ONE PATIENT, ONE ANSWER.
 *
 * The initials are the FLOOR of every avatar surface in this app — they are
 * what a doctor sees whenever a photograph is missing, and, since
 * p1-photo-fallback-1.0.0, whenever one will not decode. Four independent
 * implementations produce them, in four scopes, and nothing has ever compared
 * them:
 *
 *   ptInitials          patient list rows, team view rows, intake inbox tile
 *   _qfInitials         quick-find (Ctrl-K) results
 *   _patientInitials    the pinned active-patient face, bottom left
 *   initials()          the patient context bar, inside its own IIFE
 *
 * ptInitials took the SECOND token and the other three take the LAST, so
 * "Maria Elena Vasquez" was ME in the patient list and MV in quick-find, the
 * pinned face and the context bar — the same chart labelled two ways on one
 * screen. The context bar also floored to '-' where the others floored to '?'.
 *
 * ⛔ THIS SUITE EXECUTES ALL FOUR. Each function body is sliced out of the
 * shipped page and compiled, so it grades the real implementations rather than
 * a description of them, and it runs the SAME table through all of them. It is
 * a [[two-modules-fight-over-one-attribute]] guard: the cure for four copies
 * that must agree is not a refactor that could break three surfaces at once,
 * it is a test that fails the moment they stop agreeing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

/* Slice a function out of the page by name and compile it. Balanced-brace
   scan, so a body containing braces cannot truncate the slice — and it throws
   rather than returning a short one, because a silently-truncated function
   would compile to something that passes for the wrong reason. */
function compile(src, signature, label) {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error(label + ': signature not found — ' + signature);
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error(label + ': unbalanced body');
  const body = src.slice(i + 1, end);
  if (body.length < 40) throw new Error(label + ': body suspiciously short (' + body.length + ')');
  return new Function('name', body);
}

/* The four names, and what a person would say each one is. The table is the
   point: any implementation may be replaced, but all four must keep answering
   the same thing for every row. */
const NAMES = [
  ['Maria Elena Vasquez', 'MV', 'three tokens — the case that split them'],
  ['John Smith', 'JS', 'the ordinary two-token case'],
  ['J. Robert Oppenheimer', 'JO', 'an initial, a middle name and a surname'],
  ['Ana Sofia de la Cruz', 'AC', 'a multi-part surname'],
  ['Cher', 'C', 'one token only'],
  ['  Grace   Hopper  ', 'GH', 'ragged whitespace'],
  ['', '?', 'no name at all — the floor'],
  ['   ', '?', 'whitespace only — the floor']
];

['1p/index.html', '1pScribeFlow.html'].forEach(file => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const impls = {
    ptInitials: compile(src, 'function ptInitials(name){', file + ' ptInitials'),
    _qfInitials: compile(src, 'function _qfInitials(name){', file + ' _qfInitials'),
    _patientInitials: compile(src, 'function _patientInitials(name){', file + ' _patientInitials'),
    ctxInitials: compile(src, 'function initials(name){', file + ' ctx initials')
  };
  const keys = Object.keys(impls);
  eq(keys.length, 4, file + ': not all four initials generators were found');

  NAMES.forEach(row => {
    const [name, expected, why] = row;
    const answers = keys.map(k => {
      let v;
      try { v = impls[k](name); } catch (e) { v = 'THREW:' + e.message; }
      return k + '=' + JSON.stringify(v);
    });
    const values = keys.map(k => { try { return impls[k](name); } catch (e) { return 'THREW'; } });
    const unique = [...new Set(values)];
    eq(unique.length, 1,
      file + ': the four generators disagree on ' + JSON.stringify(name) + ' (' + why + ') — ' +
      answers.join(', ') + '. One chart, one label. [[two-modules-fight-over-one-attribute]]');
    eq(values[0], expected,
      file + ': ' + JSON.stringify(name) + ' (' + why + ') renders ' + JSON.stringify(values[0]) +
      ', expected ' + JSON.stringify(expected));
  });

  /* ⛔ A FLOOR THAT IS NOT EMPTY. The whole reason this file exists is that
     the initials are the fallback; a fallback that can render '' is the
     blank-green-disc defect wearing a different hat. */
  ['', '   ', null, undefined, '!!!', '\t\n'].forEach(bad => {
    keys.forEach(k => {
      let v;
      try { v = impls[k](bad); } catch (e) { v = ''; }
      ok(typeof v === 'string' && v.trim().length > 0,
        file + ': ' + k + '(' + JSON.stringify(bad) + ') returned ' + JSON.stringify(v) +
        ' — an empty initials floor is an unlabelled avatar');
    });
  });
});

console.log('1p avatar initials agreement: ' + passed + ' assertions passed');
